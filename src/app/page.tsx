import { t } from '@/lib/i18n'

export default function HomePage() {
  const copy = t()
  return (
    <main className="page">
      <section className="card">
        <div className="brand">{copy.brand}</div>
        <h1>{copy.welcomeTitle}</h1>
        <p>{copy.welcomeDescription}</p>
      </section>
    </main>
  )
}
