import Link from "next/link";
import { ArrowRight, Check, FileQuestion, Mail, ScanFace, Scale, ScrollText, UserCheck, Video, VideoOff } from "lucide-react";
import { SampleCall } from "@/components/SampleCall";
import { ShellMark } from "@/components/ShellMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Wordmark } from "@/components/Wordmark";

const steps = [
  { icon: Mail, title: "Krijo call-in", text: "Cakto titullin, kandidatin dhe, nëse do, një test. Ftesa i dërgohet me email; mund të kërkosh edhe verifikim të email-it me kod." },
  { icon: UserCheck, title: "Kandidati përgatitet", text: "Pa llogari: lexon çfarë regjistrohet, pranon, kontrollon kamerën dhe mikrofonin dhe hyn nga linku." },
  { icon: Video, title: "Drejto call-in", text: "Video, ndarje ekrani, test dhe sinjale në një dhomë. Shënimet e tua private ruhen vetë gjatë call-it." },
  { icon: ScrollText, title: "Shqyrto", text: "Pas call-it sheh vijën kohore, sinjalet me shpjegim dhe sa kohë raportoi monitori, dhe shkruan përfundimin tënd." },
];

const states = [
  { name: "Aktivitet normal", text: "Zonë e qetë: monitori raportonte dhe nuk u vëzhgua asgjë e veçantë." },
  { name: "Sinjal i vëzhguar", text: "Shenjë me formë, fjalë dhe ngjyrë, jo vetëm ngjyrë. Sa më e lartë, aq më e rëndësishme për t'u parë." },
  { name: "Pa monitorim", text: "Vijëzim: browser-i nuk raportoi. Nuk dihet çfarë ndodhi dhe as nuk thuhet se ishte në rregull." },
];

const limits = [
  { icon: VideoOff, title: "Nuk regjistron video ose zë", text: "Kamera dhe mikrofoni transmetohen live dhe nuk ruhen. Ruhen vetëm sinjalet: lloji, koha dhe kohëzgjatja." },
  { icon: Scale, title: "Nuk merr vendime", text: "Asnjë kandidat nuk refuzohet automatikisht. Përfundimin e shkruan një njeri, dhe regjistrohet kush e shqyrtoi dhe kur." },
  { icon: ScanFace, title: "Nuk lexon emocione", text: "Pa emotion recognition, pa lie detection, pa analizë personaliteti." },
  { icon: FileQuestion, title: "Nuk jep provë", text: "Sinjalet vijnë nga browser-i i kandidatit, që e kontrollon ai. Mund të mungojnë ose të gabojnë (dy monitorë, njoftime). Prandaj çdo sinjal thotë çfarë nuk tregon." },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-canvas text-navy">
      <header className="border-b border-line bg-white">
        <nav aria-label="Kryesore" className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-2.5">
          <Link href="/" className="flex items-center gap-3 font-bold">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-shell-200"><ShellMark className="h-6 w-6" /></span>
            <span><Wordmark /></span>
          </Link>
          <div className="hidden items-center gap-1 whitespace-nowrap md:flex">
            <a href="#si-funksionon" className="btn-ghost">Si funksionon</a>
            <a href="#sinjalet" className="btn-ghost">Sinjalet</a>
            <a href="#kufijte" className="btn-ghost">Kufijtë</a>
            <Link href="/privacy" className="btn-ghost">Privatësia</Link>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login" className="btn-secondary">Hyr</Link>
          </div>
        </nav>
      </header>

      <main id="main">
        <section className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:py-16 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
          <div>
            <p className="eyebrow">Intervista dhe teste online · shqyrtim njerëzor</p>
            <h1 className="mt-4 text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">
              Sinjale të qarta.<br /><span className="text-moss">Vendimin e merr njeriu.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
              Bëj intervista live në browser dhe shiko, ndërsa ndodhin, çfarë ka raportuar browser-i i kandidatit. Pa regjistrim të videos dhe pa akuza automatike: çdo sinjal vjen me shpjegimin e tij dhe me atë që nuk tregon.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="btn-primary">Krijo llogari host <ArrowRight size={17} aria-hidden="true" /></Link>
              <Link href="/login" className="btn-secondary">Hyr</Link>
            </div>
            <ul className="mt-8 space-y-2 text-sm text-slate-600">
              {["Kandidati hyn pa llogari, nga një link", "Video dhe zëri nuk regjistrohen", "Fshirje automatike pas afatit që zgjedh"].map((item) => (
                <li key={item} className="flex items-center gap-2.5"><Check size={16} className="shrink-0 text-moss" aria-hidden="true" />{item}</li>
              ))}
            </ul>
          </div>
          <SampleCall />
        </section>

        <section id="si-funksionon" className="scroll-mt-6 border-y border-line bg-white">
          <div className="mx-auto max-w-6xl px-5 py-14">
            <h2 className="section-title">Si funksionon</h2>
            <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li key={step.title} className="rounded-xl border border-line bg-canvas p-5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-medium text-muted">{String(index + 1).padStart(2, "0")}</span>
                      <Icon size={18} className="text-teal" aria-hidden="true" />
                    </div>
                    <h3 className="mt-4 font-semibold">{step.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{step.text}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section id="sinjalet" className="mx-auto max-w-6xl scroll-mt-6 px-5 py-14">
          <h2 className="section-title">Si lexohet një sinjal</h2>
          <p className="mt-4 max-w-2xl text-slate-600">
            Vija e mësipërme është një call i vizatuar. Tri gjendje vizatohen qëllimisht ndryshe, që mungesa e të dhënave të mos duket kurrë si “gjithçka në rregull”.
          </p>
          <dl className="mt-8 grid gap-4 md:grid-cols-3">
            {states.map((state) => (
              <div key={state.name} className="rounded-xl border border-line bg-white p-5">
                <dt className="font-semibold">{state.name}</dt>
                <dd className="mt-2 text-sm leading-6 text-slate-600">{state.text}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 max-w-3xl text-sm leading-6 text-muted">
            Për të renditur call-et, një sinjal i lartë, dy të mesëm ose gjashtë të vegjël e vendosin call-in te “Kërkon shqyrtim”. Është një rregull renditjeje, jo gjykim; sinjalet “info” nuk e vendosin kurrë.
          </p>
        </section>

        <section id="kufijte" className="scroll-mt-6 border-y border-line bg-white">
          <div className="mx-auto max-w-6xl px-5 py-14">
            <h2 className="section-title">Çfarë nuk bën, me qëllim</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {limits.map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.title} className="flex gap-4 rounded-xl border border-line bg-canvas p-5">
                    <Icon size={20} className="mt-0.5 shrink-0 text-teal" aria-hidden="true" />
                    <div>
                      <h3 className="font-semibold">{item.title}</h3>
                      <p className="mt-1.5 text-sm leading-6 text-slate-600">{item.text}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-14">
          <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
            <div>
              <h2 className="section-title">Për kandidatët</h2>
              <p className="mt-4 text-2xl font-bold leading-snug tracking-tight">Kandidati e di çfarë ndodh para se të hyjë.</p>
              <p className="mt-3 text-slate-600">Faqja e pranimit shpjegon çfarë mblidhet, pse dhe sa kohë ruhet. Pa pranim nuk hapet dhoma.</p>
              <p className="mt-5"><Link href="/privacy" className="font-semibold text-teal underline underline-offset-2">Lexo politikën e privatësisë</Link></p>
            </div>
            <ul className="space-y-3">
              {["Pranimi i shkruar qartë, me arsyen dhe afatin e ruajtjes për secilin lloj të dhënash", "Kontroll i kamerës, mikrofonit dhe lidhjes para hyrjes", "Pa llogari dhe pa instalim", "Në fund, një faqe që thotë çfarë ndodh më tej dhe çfarë u ruajt"].map((item) => (
                <li key={item} className="flex gap-3 rounded-xl border border-line bg-white p-4 text-sm leading-6"><Check size={18} className="mt-0.5 shrink-0 text-moss" aria-hidden="true" />{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-t border-line bg-teal">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-12 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl text-2xl font-bold leading-snug tracking-tight text-white">Provoje me një call të vërtetë, me kandidatin tënd.</p>
            <div className="flex flex-wrap gap-3">
              <Link href="/register" className="btn-gold">Krijo llogari host</Link>
              <Link href="/login" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/40 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">Hyr</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted">
          <span className="font-bold text-navy"><Wordmark /></span>
          <nav aria-label="Poshtë" className="flex flex-wrap gap-x-5 gap-y-1">
            <Link href="/privacy" className="hover:text-navy">Privatësia</Link>
            <Link href="/login" className="hover:text-navy">Hyr</Link>
            <Link href="/register" className="hover:text-navy">Regjistrohu</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
