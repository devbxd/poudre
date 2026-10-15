import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ExternalLink, ImagePlus, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch } from '../lib/hooks.js';
import { Button, Card, Field, Input, PageHeader, Spinner, useAction, useToast } from '../components/ui.jsx';
import { MediaPicker } from '../components/MediaPicker.jsx';

/** Picture with a "Change" button (media library or upload) */
function ImageSlot({ label, url, onChange, tall }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="mb-1 text-[13px] font-medium text-zinc-700">{label}</div>
      <button type="button" onClick={() => setOpen(true)} title="Change the picture"
        className={`group relative flex w-full items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 ${tall ? 'aspect-[4/5]' : 'aspect-[16/9]'}`}>
        {url ? <img src={url} alt="" className="h-full w-full object-contain" /> : <span className="text-zinc-400">No picture</span>}
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/60 py-1.5 text-[13px] text-white opacity-90 group-hover:opacity-100"><ImagePlus size={14} /> Change</span>
      </button>
      <MediaPicker open={open} onClose={() => setOpen(false)} onPick={([m]) => m && onChange(m.url)} />
    </div>
  );
}

export default function Homepage() {
  const { data: defaults } = useFetch('/admin/homepage-defaults');
  const { data: saved } = useFetch('/admin/settings/homepage');
  const [slides, setSlides] = useState(null);
  const [banners, setBanners] = useState(null);
  const [run, busy] = useAction();
  const { confirm } = useToast();
  useEffect(() => {
    if (!defaults || !saved) return;
    setSlides(saved.slides?.length ? saved.slides : defaults.slides);
    setBanners(defaults.banners.map((b) => ({ ...b, ...(saved.banners || []).find((x) => x.key === b.key) })));
  }, [defaults, saved]);
  if (!slides || !banners) return <Spinner />;

  const setSlide = (i, patch) => setSlides(slides.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i, d) => { const s = [...slides]; [s[i], s[i + d]] = [s[i + d], s[i]]; setSlides(s); };
  const setBanner = (i, patch) => setBanners(banners.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const save = () => run(async () => {
    const current = await api.get('/admin/settings/homepage');
    return api.put('/admin/settings/homepage', { ...current, slides, banners });
  }, 'Homepage saved — the website shows it within a minute');
  const reset = async () => {
    if (!(await confirm({ title: 'Put back the original pictures?', message: 'Slides and banners go back to how they were on the old website.', confirmLabel: 'Put back' }))) return;
    await run(async () => {
      const { slides: _, banners: __, ...rest } = await api.get('/admin/settings/homepage');
      return api.put('/admin/settings/homepage', rest);
    }, 'Original pictures restored');
    setSlides(defaults.slides);
    setBanners(defaults.banners);
  };

  return (
    <>
      <PageHeader title="Homepage" subtitle="Change the big slides and the category banners of the website's homepage"
        actions={<>
          <a href="/" target="_blank" rel="noreferrer"><Button icon={ExternalLink}>View website</Button></a>
          <Button icon={RotateCcw} onClick={reset}>Original pictures</Button>
          <Button variant="primary" loading={busy} onClick={save}>Save</Button>
        </>} />
      <div className="space-y-4">
        <Card title="Big slides (top of the page)" actions={<Button size="sm" icon={Plus} onClick={() => setSlides([...slides, { key: `new${Date.now()}`, image: '', mobile: '', link: '/shop/', button: 'Shop Now' }])}>Add slide</Button>}>
          <p className="mb-4 text-[13px] text-zinc-500">They change every 5 seconds. Computer picture: wide (about 1920 × 800). Phone picture: optional, taller; if empty the computer picture is used.</p>
          <div className="space-y-4">
            {slides.map((s, i) => (
              <div key={s.key} className="rounded-md border border-zinc-200 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <b>Slide {i + 1}</b>
                  <div className="flex items-center gap-1">
                    <Button size="sm" icon={ArrowUp} disabled={!i} onClick={() => move(i, -1)} title="Move up" />
                    <Button size="sm" icon={ArrowDown} disabled={i === slides.length - 1} onClick={() => move(i, 1)} title="Move down" />
                    <Button size="sm" variant="danger" icon={Trash2} disabled={slides.length === 1} onClick={() => setSlides(slides.filter((_, j) => j !== i))} title="Remove" />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                  <ImageSlot label="Computer picture" url={s.image} onChange={(url) => setSlide(i, { image: url })} />
                  <ImageSlot label="Phone picture" url={s.mobile} tall onChange={(url) => setSlide(i, { mobile: url })} />
                </div>
                {s.mobile && <button className="mt-1 text-xs text-zinc-500 hover:text-red-600" onClick={() => setSlide(i, { mobile: '' })}>Remove phone picture</button>}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Button text" hint="Empty = no button"><Input value={s.button} onChange={(e) => setSlide(i, { button: e.target.value })} /></Field>
                  <Field label="Button link" hint="e.g. /product-category/makeup/"><Input value={s.link} onChange={(e) => setSlide(i, { link: e.target.value })} /></Field>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Category banners">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {banners.map((b, i) => (
              <div key={b.key} className="space-y-2">
                <ImageSlot label={`Banner ${i + 1}`} url={b.image} tall onChange={(url) => setBanner(i, { image: url })} />
                <Field label="Button text"><Input value={b.label} onChange={(e) => setBanner(i, { label: e.target.value })} /></Field>
                <Field label="Link"><Input value={b.link} onChange={(e) => setBanner(i, { link: e.target.value })} /></Field>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
