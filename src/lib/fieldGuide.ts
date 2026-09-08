/**
 * One house style for filling the form, shared by the public page and the
 * admin modal so the same field never gets two different explanations.
 *
 * `example` is the one-liner shown next to the label. `help` is the longer
 * rule, revealed on hover. Wording differs by kind because "who runs it"
 * means the university on an admission and the funder on a scholarship.
 */
export interface FieldHint {
  example: string
  help?: string
}

type Guide = Record<string, FieldHint>

const COMMON: Guide = {
  opens_on: {
    example: 'first day you can apply',
    help: 'Leave blank if they have not announced it yet. Reminders still run off the closing date.',
  },
  closes_on: {
    example: 'last day they accept it',
    help: 'The single most important field. This is what the daily countdown counts down to.',
  },
  notes: {
    example: 'IELTS 6.5 · motivation letter · 2 referees',
    help: 'Requirements and traps, separated by "·". This text is copied into every reminder, so keep it short and factual.',
  },
  added_by: {
    example: 'Esubalew',
    help: 'Your first name, so the crew knows who to ask about it.',
  },
}

export const ADMISSION_GUIDE: Guide = {
  ...COMMON,
  title: {
    example: 'University of Verona — MSc Data Science',
    help: 'University first, then the exact programme name. Copy it the way their site writes it so nobody adds the same intake twice.',
  },
  country: {
    example: 'Italy',
    help: 'One country — where you would actually study. Pick from the list so the board groups properly.',
  },
  org: {
    example: 'University of Verona',
    help: 'Who runs the admission. For a university offer this is the university itself.',
  },
  url: {
    example: 'univr.it/en/admission',
    help: 'The page you would actually apply on, not the homepage. You can leave https:// off — it is added for you.',
  },
  application_fee: {
    example: '30',
    help: 'What it costs you to submit this application. Numbers only. Leave blank if you do not know it yet, and enter 0 if applying is free.',
  },
  links: {
    example: 'tick every scholarship this offer unlocks',
    help: 'One Verona offer can make you eligible for the merit award, the regional grant and IYT at once. Tick all of them.',
  },
}

export const SCHOLARSHIP_GUIDE: Guide = {
  ...COMMON,
  title: {
    example: 'Regional scholarship (Veneto)',
    help: 'The scholarship name as the funder writes it. Put the region or funder in brackets when the name alone is ambiguous.',
  },
  country: {
    example: 'Italy',
    help: 'Where the money can be spent. Use "Multiple / Global" if it follows you anywhere.',
  },
  org: {
    example: 'Veneto Region',
    help: 'Who pays. The funding body — not the university, unless the university itself is funding it.',
  },
  url: {
    example: 'esu.vr.it/borse-di-studio',
    help: 'The call or application page. You can leave https:// off — it is added for you.',
  },
  links: {
    example: 'tick every admission that qualifies you',
    help: 'National scholarships accept students from many universities. Holding any one of the ticked admissions is enough to be eligible.',
  },
}

export const guideFor = (kind: string): Guide =>
  kind === 'admission' ? ADMISSION_GUIDE : SCHOLARSHIP_GUIDE
