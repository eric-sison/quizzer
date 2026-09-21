//! Buffered, sequence-numbered audit trail of anything that looks like an
//! attempt to leave the exam environment.
//!
//! Events are queued locally and flushed in batches so a brief network drop
//! doesn't lose them. Sequence numbers are contiguous per session, so the
//! server can tell the difference between "nothing happened" and "we lost
//! events" - a client that goes quiet is itself a signal.

use std::collections::VecDeque;
use std::sync::Mutex;

use crate::api::ProctorEvent;
use crate::session::now_epoch_secs;

/// Beyond this the student is almost certainly hammering something; keep the
/// newest and let the seq gap tell the server we dropped the rest.
const MAX_PENDING: usize = 500;
const MAX_BATCH: usize = 50;

/// Closed taxonomy of audit-log event kinds. Some are emitted only on one
/// platform or only from the frontend, so the whole module is exempt from
/// dead-code analysis rather than sprinkling attributes over individual ones.
#[allow(dead_code)]
pub mod kind {
    pub const EXAM_STARTED: &str = "exam_started";
    pub const EXAM_SUBMITTED: &str = "exam_submitted";
    pub const FOCUS_LOST: &str = "focus_lost";
    pub const FOCUS_RESTORED: &str = "focus_restored";
    pub const CLOSE_ATTEMPT: &str = "close_attempt";
    pub const LOCKDOWN_ENGAGED: &str = "lockdown_engaged";
    pub const LOCKDOWN_DEGRADED: &str = "lockdown_degraded";
    pub const LOCKDOWN_RELEASED: &str = "lockdown_released";
    pub const BLOCKED_KEY: &str = "blocked_key";
    pub const BLOCKED_NAVIGATION: &str = "blocked_navigation";
    pub const BLOCKED_SHORTCUT: &str = "blocked_shortcut";
    pub const CLOCK_TAMPERING: &str = "clock_tampering";
    pub const HEARTBEAT_MISSED: &str = "heartbeat_missed";
    pub const SESSION_REVOKED: &str = "session_revoked";
}

#[derive(Default)]
struct Inner {
    seq: u64,
    pending: VecDeque<ProctorEvent>,
    dropped: u64,
}

#[derive(Default)]
pub struct EventQueue {
    inner: Mutex<Inner>,
}

impl EventQueue {
    /// Queue an event. Returns its sequence number.
    pub fn record(&self, kind: &str, detail: Option<String>) -> u64 {
        let mut inner = self.inner.lock().expect("event queue poisoned");
        inner.seq += 1;
        let seq = inner.seq;

        inner.pending.push_back(ProctorEvent {
            seq,
            kind: kind.to_string(),
            at: now_epoch_secs(),
            detail,
        });

        while inner.pending.len() > MAX_PENDING {
            inner.pending.pop_front();
            inner.dropped += 1;
        }

        seq
    }

    /// Take up to `MAX_BATCH` events for sending. They stay out of the queue
    /// unless `requeue` puts them back, so a successful send can't double-post.
    pub fn take_batch(&self) -> Vec<ProctorEvent> {
        let mut inner = self.inner.lock().expect("event queue poisoned");
        let n = inner.pending.len().min(MAX_BATCH);
        inner.pending.drain(..n).collect()
    }

    /// Return a failed batch to the front of the queue, preserving order.
    pub fn requeue(&self, events: Vec<ProctorEvent>) {
        let mut inner = self.inner.lock().expect("event queue poisoned");
        for event in events.into_iter().rev() {
            inner.pending.push_front(event);
        }
        while inner.pending.len() > MAX_PENDING {
            inner.pending.pop_back();
            inner.dropped += 1;
        }
    }

    pub fn has_pending(&self) -> bool {
        !self.inner.lock().expect("event queue poisoned").pending.is_empty()
    }

    pub fn reset(&self) {
        *self.inner.lock().expect("event queue poisoned") = Inner::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assigns_contiguous_sequence_numbers() {
        let q = EventQueue::default();
        assert_eq!(q.record(kind::FOCUS_LOST, None), 1);
        assert_eq!(q.record(kind::FOCUS_RESTORED, None), 2);
    }

    #[test]
    fn a_failed_batch_goes_back_in_order() {
        let q = EventQueue::default();
        q.record(kind::FOCUS_LOST, None);
        q.record(kind::FOCUS_RESTORED, None);
        q.record(kind::BLOCKED_KEY, None);

        let batch = q.take_batch();
        assert_eq!(batch.len(), 3);
        assert!(!q.has_pending());

        q.requeue(batch);
        let again = q.take_batch();
        assert_eq!(
            again.iter().map(|e| e.seq).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
    }

    #[test]
    fn a_batch_never_exceeds_the_cap() {
        let q = EventQueue::default();
        for _ in 0..(MAX_BATCH + 10) {
            q.record(kind::BLOCKED_KEY, None);
        }
        assert_eq!(q.take_batch().len(), MAX_BATCH);
        assert!(q.has_pending());
    }

    #[test]
    fn overflow_drops_oldest_and_leaves_a_visible_seq_gap() {
        let q = EventQueue::default();
        for _ in 0..(MAX_PENDING + 5) {
            q.record(kind::BLOCKED_KEY, None);
        }
        let batch = q.take_batch();
        // First surviving event is not seq 1, which is exactly the signal the
        // server needs to know the client dropped events.
        assert!(batch[0].seq > 1);
    }
}
