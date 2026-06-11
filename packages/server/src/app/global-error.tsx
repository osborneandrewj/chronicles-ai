"use client";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body>
        <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
          <h1>Something went wrong</h1>
          <p>{error.message}</p>
        </main>
      </body>
    </html>
  );
}
