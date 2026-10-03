/** Serialize saves per draft and retain only the newest edit waiting behind IPC. */
export function createDraftWriter<T = string>(save: (key: string, value: T) => Promise<unknown>, onError: (error: unknown, key: string) => void, merge: (previous: T, next: T) => T = (_previous, next) => next) {
  interface Job { next: T | undefined; cancelled: boolean; promise: Promise<void>; }
  const jobs = new Map<string, Job>();
  const drain = async (key: string, job: Job) => {
    try {
      while (!job.cancelled && job.next !== undefined) {
        const value = job.next;
        job.next = undefined;
        try { await save(key, value); }
        catch (error) { if (!job.cancelled) onError(error, key); }
      }
    } finally { if (jobs.get(key) === job) jobs.delete(key); }
  };
  return {
    write(key: string, value: T): Promise<void> {
      const pending = jobs.get(key);
      if (pending) { pending.next = pending.next === undefined ? value : merge(pending.next, value); return pending.promise; }
      const job: Job = { next: value, cancelled: false, promise: Promise.resolve() };
      jobs.set(key, job);
      job.promise = drain(key, job);
      return job.promise;
    },
    forget(key: string) {
      const job = jobs.get(key);
      if (job) { job.cancelled = true; jobs.delete(key); }
    },
  };
}
