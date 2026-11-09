"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";

export function Header() {
  const { user, signOut } = useSession();
  const router = useRouter();
  return (
    <header className="topbar">
      <Link href={user ? "/projects" : "/"} className="brand">
        SceneFlow
      </Link>
      {user ? (
        <div className="row">
          <span className="muted small">{user.email}</span>
          <button
            className="btn sm"
            onClick={async () => {
              await signOut();
              router.push("/login");
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </header>
  );
}
