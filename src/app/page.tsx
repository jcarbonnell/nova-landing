// src/app/page.tsx
import { getServerSession } from '@/lib/auth0';  // New async wrapper
import HomeClient from './HomeClient';

export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

export default async function Home() {
  try {
    const session = await getServerSession();
    const serverUser = session?.user;
    return <HomeClient serverUser={serverUser} />;
  } catch (error) {
    console.error('Server session error:', error);
    return (
      <div className="p-4 text-center text-red-600">
        Session error - <a href="/api/auth/login">Login</a>
      </div>
    );
  }
}