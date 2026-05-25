export type BookingLinks = {
  pr?: string;
  mcm?: string;
  support?: string;
};

const COACH_BOOKING_LINKS: Array<{ keywords: string[]; links: BookingLinks }> = [
  {
    keywords: ["olivia"],
    links: {
      pr: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/dFNqOwBdgEaEnzYyrKQ3Sw2",
      mcm: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/sVb8a69Fy0WmmOBY0UDUcA2",
      support: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/I26h14gLCESW1sxisFM7NA2",
    },
  },
  {
    keywords: ["nathan"],
    links: {
      pr: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/cD5Vu9DAW0mA0wTzEzFPyQ2",
      mcm: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/sOlaJ_qRXUuKW0tknorlSA2",
      support: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/WJu2iWdZMku9gFEiGcVZCg2",
    },
  },
  {
    keywords: ["med mahed", "med"],
    links: {
      pr: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/c_U0n1_6k06L_aaRnhkgFg2",
      mcm: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/PFekNBL6oUqAejWYB0nFmw2",
    },
  },
  {
    keywords: ["afaan"],
    links: {
      pr: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/WB0OhjYBnkOUDSmQg8U4tA2",
      mcm: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/c_U0n1_6k06L_aaRnhkgFg2",
      support: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/am3yIdDiWkyhswT5bmUmmQ2",
    },
  },
  {
    keywords: ["adey"],
    links: {
      pr: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/W-eBLyTD0k-UURhGphvkow2",
      mcm: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/SwGm1Rw_VEuH30T3uMCqqQ2",
      support: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/YEVcJPhRGUmXklGtQUvBxQ2",
    },
  },
  {
    keywords: ["omar elshafey", "elshafey"],
    links: {
      pr: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/StuOku3Yj0OUArXia_xyvQ2",
      mcm: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/MkgcYWNgQkW2KoPi33DIWw2",
      support: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/3dm3EYtqeUaZkOT5d5uHnA2",
    },
  },
  {
    keywords: ["femi"],
    links: {
      pr: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/IGh66wXsGkO5lTMChwedWg2",
      mcm: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/zA1Bl-1bfka3r8rL7jYFWg2",
      support: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/5IzsGB6Cn0CiBZoHSMwg-g2",
    },
  },
  {
    keywords: ["patryk"],
    links: {
      pr: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/DnsBHSBGf02k6B5a-SHLkg2",
      mcm: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/Mdv9cavs4k-Kd-QxtnuRyA2",
      support: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/kprnq89GFkm4DQSQEoQCow2",
    },
  },
  {
    keywords: ["aryan"],
    links: {
      pr: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/TCHiMSlFVki43fd3Bn-VuQ2",
      mcm: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/u7sJl0vk70K-e0pBIb3oaw2",
      support: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/Mlg2XabMGEeBIOTvnoyjTQ2",
    },
  },
  {
    keywords: ["radwa"],
    links: {
      pr: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/ZKfy0mhlJEmDOWdw09A1-w2",
      mcm: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/c2dWk2XOika08hUsW2wfPw2",
      support: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/V6Ia2JJGWEKoFw7GLTCaUw2",
    },
  },
  {
    keywords: ["omar badr", "badr"],
    links: {
      pr: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/2zB4YR9Uu0S1H8i3_Dtzhw2",
      mcm: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/QfBvGHQZ1028lF4M4ys_FA2",
      support: "https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/C2y6G5Uut0yqA4C44_p1bw2",
    },
  },
];

export function getBookingLinks(coachName: string): BookingLinks {
  const lower = String(coachName || "").trim().toLowerCase();
  if (!lower) return {};

  for (const entry of COACH_BOOKING_LINKS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.links;
    }
  }
  return {};
}
