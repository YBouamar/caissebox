import type { Metadata } from 'next';
import { LogoMark } from '@/components/Logo';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Connexion' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expire?: string }> }) {
  const { expire } = await searchParams;
  return (
    <div className="login">
      <div className="login-side">
        <div className="row">
          <LogoMark size={44} />
          <span className="brand-word" style={{ fontSize: 26 }}>
            <span>caisse</span>
            <b>box</b>
          </span>
        </div>
        <div className="stack">
          <h2 style={{ fontSize: 32, maxWidth: 460 }}>La caisse qui continue de tourner, même sans internet.</h2>
          <p>Suivez vos recettes, vos serveurs et votre carte depuis n’importe où. Tout ce que vous modifiez ici arrive sur les tablettes en quelques secondes.</p>
        </div>
        <span className="small" style={{ color: '#B8C2D3' }}>
          Un service BACYBRAINS · Casablanca
        </span>
      </div>
      <div className="login-form">
        <LoginForm expired={expire === '1'} />
      </div>
    </div>
  );
}
