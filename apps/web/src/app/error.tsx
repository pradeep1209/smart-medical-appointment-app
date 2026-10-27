'use client';
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <main className="error-page"><h1>Clinic information could not load</h1><p>Check that the clinic service is available, then try again.</p><button className="button" onClick={reset}>Try again</button><a href="/login">Return to sign in</a></main>; }
