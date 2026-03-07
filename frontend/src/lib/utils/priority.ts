export function getPriority(dueDate?: string) {
  if (!dueDate) return "Unknown";

  const today = new Date();
  const due = new Date(dueDate);

  const diff = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diff < 0) return "Critical";
  if (diff <= 7) return "Critical";
  if (diff <= 14) return "High";
  if (diff <= 30) return "Medium";
  return "Low";
}