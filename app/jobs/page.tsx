import { Suspense } from "react";
import { JobsBoard } from "@/components/jobs-board";

export default function JobsPage() {
  return (
    <Suspense>
      <JobsBoard />
    </Suspense>
  );
}
