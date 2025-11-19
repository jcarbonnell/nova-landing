// src/app/page.tsx
import { getServerSession, type User } from '@/lib/auth0';
import HomeClient from './HomeClient';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function Home() {
  try {
    const session = await getServerSession();
    const serverUser = session?.user as User | null | undefined;
    return <HomeClient serverUser={serverUser} />;
  } catch (error) {
    console.error('Server session error:', error);
    return (
      <div className="p-4 text-center text-red-600">
        Session error - <Link href="/api/auth/login">Login</Link>
      </div>
    );
  }
}