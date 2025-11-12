// src/app/page.tsx
import { getServerSession } from '@/lib/auth0';  // New async wrapper
import HomeClient from './HomeClient';

export const runtime = 'nodejs';  // Ensure Node.js (cookies available)

export default async function Home() {
  try {
    const session = await getServerSession();  // Awaits cookies Promise
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