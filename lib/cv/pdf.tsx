import {
  Document,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { CvVariant, Profile } from "./types";
import { sanitizeVariant } from "./variant";

// Built-in Helvetica keeps the text layer simple, which applicant tracking
// systems parse reliably. One column, standard section names.
const s = StyleSheet.create({
  page: { paddingVertical: 28, paddingHorizontal: 38, fontFamily: "Helvetica", fontSize: 9.1, color: "#111", lineHeight: 1.3 },
  name: { fontSize: 20, lineHeight: 1.15, fontFamily: "Helvetica-Bold", textAlign: "center", marginBottom: 3 },
  headline: { fontSize: 9.8, textAlign: "center", color: "#333" },
  contact: { fontSize: 8.8, textAlign: "center", marginTop: 3, color: "#333" },
  link: { color: "#111", textDecoration: "none" },
  section: { marginTop: 8 },
  h2: { fontSize: 10.6, fontFamily: "Helvetica-Bold", borderBottomWidth: 0.8, borderBottomColor: "#111", paddingBottom: 1.5, marginBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  bold: { fontFamily: "Helvetica-Bold" },
  italic: { fontFamily: "Helvetica-Oblique", color: "#333" },
  job: { marginBottom: 5 },
  bullet: { flexDirection: "row", marginTop: 1.5, paddingLeft: 6 },
  dot: { width: 9 },
  bulletText: { flex: 1 },
  line: { marginBottom: 1.5 },
});

function CvDocument({ profile, variant }: { profile: Profile; variant: CvVariant }) {
  const bulletsFor = (company: string) =>
    variant.experience.find((e) => e.company === company)?.bullets ?? [];
  const projects = variant.projects
    .map((name) => profile.projects.find((p) => p.name === name))
    .filter((p): p is Profile["projects"][number] => !!p);
  const contactBits = [profile.location, profile.phone, profile.email].filter(Boolean);

  return (
    <Document title={`${profile.name} - CV`} author={profile.name}>
      <Page size="LETTER" style={s.page}>
        <Text style={s.name}>{profile.name}</Text>
        {variant.headline ? <Text style={s.headline}>{variant.headline}</Text> : null}
        <Text style={s.contact}>{contactBits.join("  |  ")}</Text>
        {profile.links.length ? (
          <Text style={s.contact}>
            {profile.links.map((l, i) => (
              <Text key={l.url}>
                {i ? "  |  " : ""}
                <Link src={l.url} style={s.link}>
                  {l.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                </Link>
              </Text>
            ))}
          </Text>
        ) : null}

        {variant.summary ? (
          <View style={s.section}>
            <Text style={s.h2}>Summary</Text>
            <Text>{variant.summary}</Text>
          </View>
        ) : null}

        <View style={s.section}>
          <Text style={s.h2}>Experience</Text>
          {profile.experience.map((job) => (
            <View key={`${job.company}-${job.start}`} style={s.job} wrap={false}>
              <View style={s.row}>
                <Text style={s.bold}>{job.company}</Text>
                <Text style={s.bold}>
                  {job.start} - {job.end}
                </Text>
              </View>
              <View style={s.row}>
                <Text style={s.italic}>{job.title}</Text>
                <Text style={s.italic}>{job.location}</Text>
              </View>
              {bulletsFor(job.company).map((b) => (
                <View key={b} style={s.bullet}>
                  <Text style={s.dot}>•</Text>
                  <Text style={s.bulletText}>{b}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        {projects.length ? (
          <View style={s.section}>
            <Text style={s.h2}>Projects</Text>
            {projects.map((p) => (
              <View key={p.name} style={[s.row, s.line]}>
                <Text style={{ flex: 1 }}>
                  <Text style={s.bold}>{p.name}</Text>
                  {p.description ? ` - ${p.description}` : ""}
                  {p.tech ? <Text style={s.italic}>{`  |  ${p.tech}`}</Text> : null}
                </Text>
                {p.url ? (
                  <Link src={/^https?:/.test(p.url) ? p.url : `https://${p.url}`} style={s.link}>
                    {p.url.replace(/^https?:\/\/(www\.)?/, "")}
                  </Link>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {variant.skills.length ? (
          <View style={s.section}>
            <Text style={s.h2}>Technical Skills</Text>
            {variant.skills.map((g) => (
              <Text key={g.category} style={s.line}>
                <Text style={s.bold}>{g.category}: </Text>
                {g.items.join(", ")}
              </Text>
            ))}
          </View>
        ) : null}

        {profile.education.length ? (
          <View style={s.section}>
            <Text style={s.h2}>Education</Text>
            {profile.education.map((e) => (
              <View key={e.school} style={s.line}>
                <View style={s.row}>
                  <Text style={s.bold}>{e.school}</Text>
                  <Text style={s.bold}>
                    {[e.start, e.end].filter(Boolean).join(" - ")}
                  </Text>
                </View>
                <Text style={s.italic}>{e.degree}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Page>
    </Document>
  );
}

/** Renders the CV for one job. Content is re-checked against the master CV first. */
export async function renderCv(
  profile: Profile,
  variant: CvVariant | null | undefined,
): Promise<Buffer> {
  return renderToBuffer(
    <CvDocument profile={profile} variant={sanitizeVariant(profile, variant)} />,
  );
}
