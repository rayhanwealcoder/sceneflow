"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/session";

export default function Home() {
  const { user } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (user === undefined) return;
    router.replace(user ? "/projects" : "/login");
  }, [user, router]);
  return <p className="muted">Loading…</p>;
}
