import { DEFAULT_SETTINGS, type SettingsSchema } from '../settings/schema';

/** Match path segments, not arbitrary regular expressions supplied by settings. */
export function compileExclusions(excludes: string[]): RegExp[] {
  return excludes.filter(pattern => typeof pattern === 'string' && pattern.trim()).map(pattern => {
    const normalized = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    const recursiveDirectory = normalized.endsWith('/**');
    const glob = recursiveDirectory ? normalized.slice(0, -3) : normalized;
    let expression = glob.split(/(\*\*\/|\*\*|\*|\?)/).map(part => {
      if (part === '**/') return '(?:.*/)?';
      if (part === '**') return '.*';
      if (part === '*') return '[^/]*';
      if (part === '?') return '[^/]';
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    if (recursiveDirectory) expression += '(?:/.*)?';
    if (normalized === '.env') expression += '(?:\\.[^/]*)?';
    return new RegExp(`${normalized.includes('/') ? '^' : '(?:^|/)'}${expression}(?:/|$)`, 'i');
  });
}

export function isExcluded(filePath: string, patterns: RegExp[]): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return patterns.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(normalized);
  });
}

/** One conservative policy for both preview and actual provider context. */
export function getContextLoadOptions(settings: SettingsSchema) {
  const context = settings.context ?? DEFAULT_SETTINGS.context;
  return {
    enabled: context.enabled === true,
    includeFileTree: context.includeFileTree !== false,
    includeFileContents: context.includeFileContents !== false,
    excludePatterns: compileExclusions([
      ...DEFAULT_SETTINGS.context.excludes,
      ...(Array.isArray(context.excludes) ? context.excludes : []),
    ]),
    maxFiles: 5,
    maxFileSize: 50 * 1024,
    maxTotalSize: 200 * 1024,
  };
}
