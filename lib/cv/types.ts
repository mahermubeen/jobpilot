/** The master CV. Everything a tailored CV shows must come from here. */
export type Profile = {
  name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  links: { label: string; url: string }[];
  summary: string;
  experience: {
    company: string;
    title: string;
    location: string;
    start: string;
    end: string;
    bullets: string[];
  }[];
  projects: { name: string; description: string; tech: string; url: string }[];
  skills: { category: string; items: string[] }[];
  education: { school: string; degree: string; start: string; end: string }[];
};

/** A per-job selection and ordering of master CV content. */
export type CvVariant = {
  headline: string;
  summary: string;
  experience: { company: string; bullets: string[] }[];
  skills: { category: string; items: string[] }[];
  projects: string[];
};

export const emptyProfile: Profile = {
  name: "",
  headline: "",
  email: "",
  phone: "",
  location: "",
  links: [],
  summary: "",
  experience: [],
  projects: [],
  skills: [],
  education: [],
};

export function profileIsReady(p: Profile | null | undefined): p is Profile {
  return !!p && !!p.name && !!p.email && p.experience.length > 0;
}
