/** Player-facing text for a failed request: the server's own explanation, never the HTTP status prefix. */
export function errorMessage(reason: unknown, fallback: string): string {
  if (typeof reason === 'object' && reason !== null && 'data' in reason) {
    const data = (reason as { data: unknown }).data;
    if (typeof data === 'object' && data !== null && 'error' in data) {
      const error = (data as { error: unknown }).error;
      if (typeof error === 'string' && error.trim()) return error.trim();
    }
  }
  if (reason instanceof Error) {
    const text = reason.message.replace(/^HTTP \d{3}[^:]*(?::\s*|$)/, '').trim();
    if (text) return text;
  }
  return fallback;
}
