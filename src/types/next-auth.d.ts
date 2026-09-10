import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      userId: string;
      role: string;
      department: string | null;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    role: string;
    department: string | null;
    // Re-read from the database on every request so suspending or deleting an
    // account revokes an already-issued JWT instead of waiting for it to expire.
    status?: string;
  }
}
