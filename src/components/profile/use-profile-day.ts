import { useEffect, useState } from "react";
import { profileDayKey } from "@/lib/profile-stats";

/** One local-midnight timer, rearmed on focus/resume; no background polling. */
export function useProfileDay() {
  const [today, setToday] = useState(() => profileDayKey(new Date()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      setToday(profileDayKey(now));
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(refresh, next.getTime() - now.getTime() + 20);
    };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visible); };
  }, []);
  return today;
}
