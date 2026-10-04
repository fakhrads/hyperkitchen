import { useEffect, useState } from 'react'
import type { JobState } from '../../shared/types'

/** Live list of jobs, newest first. */
export function useJobs(): JobState[] {
  const [jobs, setJobs] = useState<JobState[]>([])
  useEffect(() => {
    let alive = true
    void window.hk.jobs.list().then((list) => alive && setJobs(list))
    const off = window.hk.jobs.onUpdate((job) =>
      setJobs((prev) => {
        const rest = prev.filter((j) => j.id !== job.id)
        return [job, ...rest].sort((a, b) => b.startedAt - a.startedAt)
      })
    )
    return () => {
      alive = false
      off()
    }
  }, [])
  return jobs
}

/** Start a job and resolve with its final state. */
export async function runJob(
  kind: JobState['kind'],
  params?: Record<string, unknown>
): Promise<JobState> {
  const id = await window.hk.jobs.start(kind, params)
  return new Promise((resolve) => {
    const off = window.hk.jobs.onUpdate((job) => {
      if (job.id === id && job.status !== 'running') {
        off()
        resolve(job)
      }
    })
  })
}
