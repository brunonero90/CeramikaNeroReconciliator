import { normalizeName } from './normalize';

export function tokenize(text: string): string[] {
  return normalizeName(text)
    .split(/[\s,.\-/]+/)
    .filter((t) => t.length >= 2);
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

export function similarityScore(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;

  const tokensA = tokenize(na);
  const tokensB = tokenize(nb);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  let matched = 0;
  for (const ta of tokensA) {
    for (const tb of tokensB) {
      if (ta === tb) {
        matched += 1;
        break;
      }
      const maxLen = Math.max(ta.length, tb.length);
      if (maxLen >= 3 && levenshtein(ta, tb) <= 1) {
        matched += 0.8;
        break;
      }
    }
  }

  const tokenScore = matched / Math.max(tokensA.length, tokensB.length);

  const maxLen = Math.max(na.length, nb.length);
  const editScore = 1 - levenshtein(na, nb) / maxLen;

  return Math.max(tokenScore, editScore * 0.85);
}

export function nameInText(name: string, text: string): number {
  const normalizedText = normalizeName(text);
  const normalizedName = normalizeName(name);
  if (!normalizedName || !normalizedText) return 0;

  if (normalizedText.includes(normalizedName)) return 0.95;

  const nameTokens = tokenize(normalizedName);
  if (nameTokens.length === 0) return 0;

  let found = 0;
  for (const token of nameTokens) {
    if (token.length < 3) continue;
    if (normalizedText.includes(token)) {
      found += 1;
    }
  }

  return found / nameTokens.length;
}

export function combinedNameScore(
  parentName: string,
  studentName: string,
  senderName: string,
  title: string,
): number {
  const parentInSender = nameInText(parentName, senderName);
  const parentInTitle = nameInText(parentName, title);
  const studentInTitle = nameInText(studentName, title);
  const studentInSender = nameInText(studentName, senderName);

  const parentScore = Math.max(parentInSender * 0.9, parentInTitle);
  const studentScore = Math.max(studentInTitle * 0.95, studentInSender * 0.7);
  const directSimilarity = Math.max(
    similarityScore(parentName, senderName),
    similarityScore(studentName, title),
  );

  return Math.max(parentScore, studentScore, directSimilarity * 0.85);
}
