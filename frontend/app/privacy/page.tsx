import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Wordmark } from "@/components/Wordmark";

export const metadata: Metadata = { title: "Politika e privatësisë · NemoGuardHR", robots: { index: false } };

// Describes what the software does. The operator running this deployment is responsible for the data and
// should add its legal entity and contact below (see docs/deployment.md, "Privacy page").
const sections: Array<{ title: string; body: string[] }> = [
  {
    title: "Kush është përgjegjës",
    body: ["Të dhënat i përpunon organizatori që të ftoi në call ose test (emri i tij shfaqet në faqen e pranimit). NemoGuardHR është programi që ai përdor. Të drejtat e tua (qasje, korrigjim, fshirje) i ushtron te ai: ai mund ta fshijë call-in plotësisht nga sistemi."],
  },
  {
    title: "Çfarë mblidhet",
    body: [
      "Sinjale aktiviteti nga browser-i yt gjatë call-it: dalja nga faqja ose tab-i, humbja e fokusit, fullscreen, ndryshimi i madhësisë së dritares, më shumë se një monitor, ndërprerja e lidhjes, copy/paste (vetëm numri i rreshtave dhe i shkronjave, dhe nëse duket si kod; jo teksti), fytyra që nuk shihet, disa persona, telefon i zbuluar, kamera ose ndarja e ekranit e ndalur.",
      "Çdo 5 sekonda një pamje e vogël e kamerës dërgohet te serveri për të numëruar persona dhe për të gjetur telefon. Pamja analizohet në kujtesë dhe hidhet; nuk ruhet.",
      "Koha dhe adresa IP e pranimit, përgjigjet e testit (nëse ka), emri dhe email-i yt si i ftuar.",
      "Video, zëri dhe ekrani live shkojnë drejtpërdrejt te organizatori. Platforma nuk i regjistron.",
    ],
  },
  {
    title: "Çfarë nuk bëhet",
    body: ["Nuk përdoret njohje emocionesh, zbulim gënjeshtre, analizë personaliteti ose vendim automatik. Sinjalet janë informacion për organizatorin, jo provë dhe jo verdikt; ato nuk mund të zbulojnë, për shembull, një pajisje të dytë."],
  },
  {
    title: "Sa kohë ruhet",
    body: ["Sinjalet, përgjigjet e testit dhe adresat IP fshihen automatikisht pas afatit që ka vendosur organizatori (1 deri 365 ditë pas përfundimit të call-it); afati shfaqet në faqen e pranimit. Call-et që mbeten pa u mbyllur mbyllen automatikisht dhe ndjekin të njëjtin afat. Organizatori mund ta fshijë një call menjëherë."],
  },
  {
    title: "Palë të treta",
    body: [
      "Modeli i detektimit të fytyrës ngarkohet nga ky server, jo nga CDN e jashtme.",
      "Lidhja e kamerës përdor një shërbim STUN (dhe, nëse operatori e ka vendosur, TURN) që sheh adresën tënde IP. Operatori e zgjedh këtë shërbim.",
      "Ftesën me email e dërgon ofruesi i email-it i operatorit.",
    ],
  },
  {
    title: "Pranimi",
    body: ["Para se të hysh, faqja e pranimit të tregon çfarë mblidhet dhe pse. Pa pranimin tënd call-i nuk fillon. Nëse nuk pajtohesh, mos e pranoj dhe kontakto organizatorin."],
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-mist px-5 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-center gap-3 font-bold text-navy">
          <span className="rounded-xl bg-navy p-2 text-white"><ShieldCheck size={20} /></span>
          <Wordmark />
        </div>
        <article className="card p-7 sm:p-9">
          <h1 className="text-3xl font-bold">Politika e privatësisë</h1>
          <p className="mt-3 text-slate-600">Çfarë bën ky sistem me të dhënat e tua gjatë një call-i ose testi.</p>
          {sections.map((section) => (
            <section key={section.title} className="mt-8">
              <h2 className="text-lg font-bold">{section.title}</h2>
              {section.body.map((paragraph) => <p key={paragraph} className="mt-2 text-sm leading-6 text-slate-700">{paragraph}</p>)}
            </section>
          ))}
          <p className="mt-10 text-sm"><Link href="/" className="font-semibold text-teal underline">Kthehu te faqja kryesore</Link></p>
        </article>
      </div>
    </main>
  );
}
