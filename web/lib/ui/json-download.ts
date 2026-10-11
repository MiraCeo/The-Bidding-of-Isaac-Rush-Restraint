/** Request a browser download; no network, backend or writes to the program HTML. */
export function downloadJsonFile(source: string, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([source], { type: 'application/json;charset=utf-8' }),
  );
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    link.remove();
  }
}
