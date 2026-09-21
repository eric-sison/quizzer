/**
 * The one image node the editor allows.
 *
 * Its only reference is an opaque `mediaId` minted by the API's upload
 * endpoint - there is no `src` attribute, so a document cannot point a
 * student's client at an arbitrary host. Deliberately no `parseHTML`: an <img>
 * pasted from the open web maps to nothing and is silently dropped, which
 * keeps "upload through the app" the only way an image enters a quiz.
 */
import { mergeAttributes, Node } from "@tiptap/core"

export type QuestionImageOptions = {
  /** mediaId → something an <img> can load; undefined renders a placeholder. */
  resolveSrc: (mediaId: string) => string | undefined
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    questionImage: {
      /** Insert an uploaded image at the caret. */
      insertQuestionImage: (attrs: { mediaId: string; alt?: string }) => ReturnType
    }
  }
}

export const QuestionImage = Node.create<QuestionImageOptions>({
  // Matches the node type in quiz-core's richDocSchema.
  name: "image",
  group: "block",
  atom: true,
  draggable: true,

  addOptions() {
    return { resolveSrc: () => undefined }
  },

  addAttributes() {
    // Exactly the attributes the shared schema admits; anything more would be
    // rejected by `asRichDoc` before it could reach the server.
    return {
      mediaId: { default: null },
      alt: { default: "" },
    }
  },

  renderHTML({ node }) {
    const mediaId = node.attrs.mediaId as string | null
    const src = mediaId === null ? undefined : this.options.resolveSrc(mediaId)
    return [
      "img",
      mergeAttributes({
        src,
        alt: (node.attrs.alt as string) || null,
        draggable: false,
      }),
    ]
  },

  addCommands() {
    return {
      insertQuestionImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { mediaId: attrs.mediaId, alt: attrs.alt ?? "" },
          }),
    }
  },
})
