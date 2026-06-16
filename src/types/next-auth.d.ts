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
  }
}
