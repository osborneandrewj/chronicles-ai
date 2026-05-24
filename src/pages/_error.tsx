// Pages Router error page. Exists only to override Next.js's auto-generated
// /_error which imports <Html> from next/document — that import crashes during
// static prerender of /404 and /500 because useHtmlContext has no provider in
// the standalone export path. This file is plain HTML, no <Html>, no crash.
type ErrorProps = { statusCode?: number };

function ErrorPage({ statusCode }: ErrorProps) {
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui", color: "#888" }}>
      {statusCode ? `Error ${statusCode}` : "An error occurred"}
    </div>
  );
}

ErrorPage.getInitialProps = ({ res, err }: { res?: { statusCode?: number }; err?: { statusCode?: number } }) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 404;
  return { statusCode };
};

export default ErrorPage;
