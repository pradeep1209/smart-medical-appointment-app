export function PersonAvatar({ name, large = false }: { name: string; large?: boolean }) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = (words.length > 1 ? (words[0]?.[0] ?? '') + (words.at(-1)?.[0] ?? '') : name.slice(0, 1)).toUpperCase();
  const tone = [...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 3;
  return <span className={`person-avatar${large ? ' large' : ''}`} data-tone={tone} aria-hidden="true">{letters || 'C'}</span>;
}
