const SHORT_MONTHS_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
] as const;

export function formatTimestampId(
  isoString: string,
  options?: { utc?: boolean },
): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'Waktu tidak diketahui';
  }

  const useUtc = Boolean(options?.utc);
  const hours = String(useUtc ? date.getUTCHours() : date.getHours()).padStart(
    2,
    '0',
  );
  const minutes = String(
    useUtc ? date.getUTCMinutes() : date.getMinutes(),
  ).padStart(2, '0');
  const day = useUtc ? date.getUTCDate() : date.getDate();
  const monthIdx = useUtc ? date.getUTCMonth() : date.getMonth();
  const year = useUtc ? date.getUTCFullYear() : date.getFullYear();

  const month = SHORT_MONTHS_ID[monthIdx] ?? 'Jan';
  return `${hours}:${minutes}, ${day} ${month} ${year}`;
}
