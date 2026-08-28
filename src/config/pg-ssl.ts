const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

export function pgSslFor(connectionString: string): false | { rejectUnauthorized: boolean } {
  const remote = { rejectUnauthorized: false } as const;
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return remote;
  }
  if (url.searchParams.get('sslmode') === 'disable') return false;
  return LOCAL_HOSTS.has(url.hostname) ? false : remote;
}
