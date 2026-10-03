import { Card, PageHeader } from '../components/ui.jsx';

// Filled in once the website templates are extracted (sections depend on the theme layout)
export default function Homepage() {
  return (
    <>
      <PageHeader title="Homepage" subtitle="Choose what appears on the homepage of the website" />
      <Card><p className="text-zinc-500">Coming with the website.</p></Card>
    </>
  );
}
