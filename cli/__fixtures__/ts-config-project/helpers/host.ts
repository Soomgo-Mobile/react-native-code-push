const CDN_HOST = "https://cdn.example.com";

export function downloadUrlFor(fileName: string): string {
  return `${CDN_HOST}/${fileName}`;
}
