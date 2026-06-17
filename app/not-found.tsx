import Link from 'next/link';

export default function NotFound() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: '1rem',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '4rem', fontWeight: 700, margin: 0 }}>404</h1>
      <p style={{ fontSize: '1.25rem', color: '#666', margin: 0 }}>
        Página no encontrada
      </p>
      <Link
        href="/"
        style={{ color: '#0070f3', textDecoration: 'underline', fontSize: '1rem' }}
      >
        Volver al inicio
      </Link>
    </div>
  );
}
