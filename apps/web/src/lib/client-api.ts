export async function clientApi<T>(path: string, body: unknown): Promise<T> {
  const csrf = document.cookie.split('; ').find(part => part.startsWith('careslot_csrf='))?.split('=')[1];
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}) }, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(15000) });
  } catch { throw new Error('The clinic service could not be reached. Please try again.'); }
  const result = await response.json().catch(() => ({ message: 'The clinic service is unavailable. Please try again.' }));
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/web/login') { window.location.assign('/login'); throw new Error('Your session has ended. Sign in again.'); }
    throw new Error(Array.isArray(result.message) ? result.message.join(' ') : result.message ?? 'Your request could not be completed.');
  }
  return result as T;
}
