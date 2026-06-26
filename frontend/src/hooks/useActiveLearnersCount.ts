import { useCallback, useEffect, useMemo, useState } from "react";

type ActiveLearnerSource = {
  id?: string | number;
  email?: string;
  fullName?: string;
  programStatus?: string;
};

const ACTIVE_LEARNERS_REFRESH_MS = 15_000;

const getLearnerKey = (learner: ActiveLearnerSource) =>
  String(learner.email || learner.id || learner.fullName || "").toLowerCase().trim();

const countActiveLearners = (learners: ActiveLearnerSource[]) => {
  const activeKeys = new Set<string>();

  learners.forEach((learner) => {
    if ((learner.programStatus || "").toLowerCase().trim() !== "active") return;
    const key = getLearnerKey(learner);
    if (key) activeKeys.add(key);
  });

  return activeKeys.size;
};

export function useActiveLearnersCount() {
  const [learners, setLearners] = useState<ActiveLearnerSource[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/aptem-learners/");
      if (!res.ok) return;
      const data: ActiveLearnerSource[] = await res.json();
      setLearners(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);

    const intervalId = window.setInterval(() => {
      void refresh(false);
    }, ACTIVE_LEARNERS_REFRESH_MS);

    const handleFocus = () => void refresh(false);
    const handleVisibilityChange = () => {
      if (!document.hidden) void refresh(false);
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh]);

  const count = useMemo(() => countActiveLearners(learners), [learners]);

  return { count, loading, refresh };
}
