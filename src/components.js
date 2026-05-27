export const POLL_PREFIX = "datepoll";
export const SETUP_PREFIX = "datesetup";

export function pollCustomId(pollId, chunkIndex) {
  return `${POLL_PREFIX}:${pollId}:${chunkIndex}`;
}
