"""Mirror of frontend/src/lib/bookingLinks.ts; keep both configurations in sync."""

BASE = 'https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/'
LINKS = [
    (('olivia',), ('dFNqOwBdgEaEnzYyrKQ3Sw2', 'sVb8a69Fy0WmmOBY0UDUcA2', 'I26h14gLCESW1sxisFM7NA2')),
    (('nathan',), ('cD5Vu9DAW0mA0wTzEzFPyQ2', 'sOlaJ_qRXUuKW0tknorlSA2', 'WJu2iWdZMku9gFEiGcVZCg2')),
    (('med mahed', 'med'), ('c_U0n1_6k06L_aaRnhkgFg2', 'PFekNBL6oUqAejWYB0nFmw2', '')),
    (('afaan',), ('WB0OhjYBnkOUDSmQg8U4tA2', 'c_U0n1_6k06L_aaRnhkgFg2', 'am3yIdDiWkyhswT5bmUmmQ2')),
    (('adey',), ('W-eBLyTD0k-UURhGphvkow2', 'SwGm1Rw_VEuH30T3uMCqqQ2', 'YEVcJPhRGUmXklGtQUvBxQ2')),
    (('omar elshafey', 'elshafey'), ('StuOku3Yj0OUArXia_xyvQ2', 'MkgcYWNgQkW2KoPi33DIWw2', '3dm3EYtqeUaZkOT5d5uHnA2')),
    (('femi',), ('IGh66wXsGkO5lTMChwedWg2', 'zA1Bl-1bfka3r8rL7jYFWg2', '5IzsGB6Cn0CiBZoHSMwg-g2')),
    (('patryk',), ('DnsBHSBGf02k6B5a-SHLkg2', 'Mdv9cavs4k-Kd-QxtnuRyA2', 'kprnq89GFkm4DQSQEoQCow2')),
    (('aryan',), ('TCHiMSlFVki43fd3Bn-VuQ2', 'u7sJl0vk70K-e0pBIb3oaw2', 'Mlg2XabMGEeBIOTvnoyjTQ2')),
    (('radwa',), ('ZKfy0mhlJEmDOWdw09A1-w2', 'c2dWk2XOika08hUsW2wfPw2', 'V6Ia2JJGWEKoFw7GLTCaUw2')),
    (('omar badr', 'badr'), ('2zB4YR9Uu0S1H8i3_Dtzhw2', 'QfBvGHQZ1028lF4M4ys_FA2', 'C2y6G5Uut0yqA4C44_p1bw2')),
]


def booking_links(coach):
    name = str(coach).lower().strip()
    for keywords, ids in LINKS:
        if any(key in name for key in keywords):
            return {kind: BASE + code for kind, code in zip(('pr', 'mcm', 'support'), ids) if code}
    return {}
