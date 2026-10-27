import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { User } from './types';
export async function serverApi<T>(path: string): Promise<T> {
  const jar = await cookies();
  const session = jar.get('careslot_session')?.value;
  if (!session) redirect('/login');
  let response: Response;
  try {
    response = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001'}/api/v1${path}`, { headers: { Cookie: `careslot_session=${session}` }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
  } catch { throw new Error('The clinic service could not be reached. Please try again.'); }
  if (response.status === 401) redirect('/login');
  if (response.status === 403) throw new Error('Your account does not have permission to open this clinic view.');
  if (!response.ok) throw new Error('Clinic information could not be loaded. Please try again.');
  return response.json() as Promise<T>;
}
export const clinicContext = cache(async () => {
  const { user } = await serverApi<{ user: User }>('/auth/me');
  const membership = user.memberships[0];
  if (!membership) redirect('/login');
  return { user, membership };
});
