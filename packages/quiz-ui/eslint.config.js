import { config } from "@workspace/eslint-config/react-internal"

/**
 * This package is rendered by a Next.js server component tree *and* by a Tauri
 * webview. An import from either framework compiles fine in the app that owns
 * it and breaks the other one, usually at runtime in front of a student. The
 * rule is the only thing that actually stops that, since TypeScript has no way
 * to say "these modules do not exist here".
 *
 * The repo's shared base includes eslint-plugin-only-warn, which downgrades
 * every rule everywhere to a warning. That is why this package's lint script
 * runs with `--max-warnings 0`: without it the guard below would report the
 * mistake and then exit zero, which is the same as not having it.
 */
export default [
  ...config,
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "server-only", "client-only"],
              message:
                "quiz-ui is rendered by apps/desktop too, which has no Next.js runtime.",
            },
            {
              group: ["@tauri-apps/*"],
              message:
                "quiz-ui is rendered by apps/web too, which has no Tauri runtime.",
            },
          ],
        },
      ],
    },
  },
]
