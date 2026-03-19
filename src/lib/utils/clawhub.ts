/**
 * Parse a ClawHub URL or short-form identifier into owner and skill name.
 *
 * Accepted formats:
 * - Full URL: https://clawhub.ai/{owner}/{skill-name}
 * - Short form: owner/skill-name
 */
export function parseClawHubUrl(
  input: string
): { owner: string; skillName: string } | null {
  const urlMatch = input.match(/clawhub\.ai\/([^/]+)\/([^/?#\s]+)/);
  if (urlMatch) return { owner: urlMatch[1], skillName: urlMatch[2] };

  const shortMatch = input.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shortMatch) return { owner: shortMatch[1], skillName: shortMatch[2] };

  return null;
}
