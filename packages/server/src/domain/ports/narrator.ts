// NarratorPort + NarrationStream (spec §3.5, §5.1-P5). The streaming creative
// output of the narrator. The application layer reasons over the VALUE
// `NarrationStream {chunks, completion}` — never a framework `onFinish`
// callback. The AI-SDK (`streamText` / `onFinish` / `toUIMessageStream`) lives
// in an infrastructure adapter that implements this port; the route wires it.
//
// `chunks` is the provider-agnostic UI message stream the route pipes to the
// client. `completion` resolves AFTER the source stream has fully drained — the
// flush-fires-after-onFinish ordering invariant the `dbTurnId` trailing-metadata
// part depends on (spec §5.3 risk row). The value it resolves to is whatever the
// use case computed in its post-stream work (the persisted narrator turn id).

export type NarrationStream<T = unknown> = {
  /** Provider-agnostic UI message chunks for the route to pipe to the client. */
  chunks: ReadableStream<unknown>
  /** Resolves after the stream drains and all post-stream work has run. */
  completion: Promise<T>
}
