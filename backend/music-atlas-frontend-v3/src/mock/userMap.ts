export type MockVariant = 'normal' | 'loading' | 'empty' | 'partial' | 'error';

export type Tag = {
  name: string;
  weight: number;
  kind: 'identity' | 'exploration';
};

export type RecommendationReason = 'members' | 'credits' | 'labels' | 'events' | 'country';

export type Recommendation = {
  id: string;
  name: string;
  city: string | null;
  country: string;
  scoreBand: 'high' | 'medium' | 'low';
  reasons: RecommendationReason[];
};

export type Constellation = {
  id: string;
  title: string;
  strength: 'Strong' | 'Moderate' | 'Emerging';
  seedArtists: string[];
  identityTags: Tag[];
  explorationTags: Tag[];
  recommendations: Recommendation[];
};

export type SeedSummary = {
  totalSeeds: number;
  spotifySeeds: number;
  tidalSeeds: number;
  tasteEnabledCount: number;
  contextOnlyCount: number;
  unresolvedCount: number;
};

export type UserMapPayload = {
  seedSummary: SeedSummary;
  constellations: Constellation[];
};

export type MockUserMapResponse = {
  variant: MockVariant;
  isLoading?: boolean;
  error?: string;
  data?: UserMapPayload;
};

const sharedSeedSummary: SeedSummary = {
  totalSeeds: 26,
  spotifySeeds: 18,
  tidalSeeds: 8,
  tasteEnabledCount: 21,
  contextOnlyCount: 3,
  unresolvedCount: 2
};

const metalConstellation: Constellation = {
  id: 'metal_extreme',
  title: 'Extreme / Technical Metal',
  strength: 'Strong',
  seedArtists: ['Meshuggah', 'Tesseract', 'Periphery'],
  identityTags: [
    { name: 'technical metal', weight: 1.0, kind: 'identity' },
    { name: 'progressive metal', weight: 0.86, kind: 'identity' },
    { name: 'djent', weight: 0.72, kind: 'identity' },
    { name: 'math metal', weight: 0.58, kind: 'identity' },
    { name: 'extreme metal', weight: 0.42, kind: 'identity' }
  ],
  explorationTags: [
    { name: 'sludge metal', weight: 0.83, kind: 'exploration' },
    { name: 'post-metal', weight: 0.71, kind: 'exploration' },
    { name: 'avant-garde metal', weight: 0.64, kind: 'exploration' }
  ],
  recommendations: [
    {
      id: '9001',
      name: 'Vildhjarta',
      city: 'Hudiksvall',
      country: 'Sweden',
      scoreBand: 'high',
      reasons: []
    },
    {
      id: '9002',
      name: "Fredrik Thordendal's Special Defects",
      city: 'Stockholm',
      country: 'Sweden',
      scoreBand: 'high',
      reasons: ['members']
    },
    {
      id: '9003',
      name: "Humanity's Last Breath",
      city: null,
      country: 'Sweden',
      scoreBand: 'medium',
      reasons: []
    },
    {
      id: '9004',
      name: 'Car Bomb',
      city: 'New York',
      country: 'United States',
      scoreBand: 'medium',
      reasons: ['events']
    },
    {
      id: '9005',
      name: 'Gojira',
      city: 'Bayonne',
      country: 'France',
      scoreBand: 'low',
      reasons: ['labels']
    }
  ]
};

const jazzConstellation: Constellation = {
  id: 'jazz_fusion',
  title: 'Progressive Jazz / Fusion',
  strength: 'Moderate',
  seedArtists: ['Pat Metheny', 'John Scofield'],
  identityTags: [
    { name: 'jazz fusion', weight: 1.0, kind: 'identity' },
    { name: 'progressive jazz', weight: 0.81, kind: 'identity' },
    { name: 'instrumental jazz', weight: 0.63, kind: 'identity' },
    { name: 'modern jazz', weight: 0.47, kind: 'identity' },
    { name: 'contemporary jazz', weight: 0.31, kind: 'identity' }
  ],
  explorationTags: [
    { name: 'ECM jazz', weight: 0.79, kind: 'exploration' },
    { name: 'avant-jazz', weight: 0.66, kind: 'exploration' },
    { name: 'chamber jazz', weight: 0.52, kind: 'exploration' }
  ],
  recommendations: [
    {
      id: '9101',
      name: 'Gary Burton',
      city: 'Anderson',
      country: 'United States',
      scoreBand: 'high',
      reasons: ['credits']
    },
    {
      id: '9102',
      name: 'Charlie Haden',
      city: 'Shenandoah',
      country: 'United States',
      scoreBand: 'high',
      reasons: ['credits']
    },
    {
      id: '9103',
      name: 'Bill Frisell',
      city: 'Baltimore',
      country: 'United States',
      scoreBand: 'medium',
      reasons: []
    },
    {
      id: '9104',
      name: 'Eberhard Weber',
      city: null,
      country: 'Germany',
      scoreBand: 'medium',
      reasons: ['labels']
    },
    {
      id: '9105',
      name: 'Jan Garbarek',
      city: 'Mysen',
      country: 'Norway',
      scoreBand: 'low',
      reasons: ['country']
    }
  ]
};

const recommendationsBench: Recommendation[] = [
  { id: '9201', name: 'Animals As Leaders', city: 'Washington D.C.', country: 'United States', scoreBand: 'high', reasons: [] },
  { id: '9202', name: 'Chon', city: 'Oceanside', country: 'United States', scoreBand: 'medium', reasons: ['events'] },
  { id: '9203', name: 'Plini', city: 'Sydney', country: 'Australia', scoreBand: 'high', reasons: ['credits'] },
  { id: '9204', name: 'Allan Holdsworth', city: 'Bradford', country: 'United Kingdom', scoreBand: 'medium', reasons: ['credits'] },
  { id: '9205', name: 'Hiromi Uehara', city: 'Shizuoka', country: 'Japan', scoreBand: 'high', reasons: [] },
  { id: '9206', name: 'GoGo Penguin', city: 'Manchester', country: 'United Kingdom', scoreBand: 'medium', reasons: ['labels'] },
  { id: '9207', name: 'Riverside', city: 'Warsaw', country: 'Poland', scoreBand: 'medium', reasons: ['events'] },
  { id: '9208', name: 'Opeth', city: 'Stockholm', country: 'Sweden', scoreBand: 'medium', reasons: [] },
  { id: '9209', name: 'Cloudkicker', city: 'Columbus', country: 'United States', scoreBand: 'low', reasons: [] },
  { id: '9210', name: 'Haken', city: 'London', country: 'United Kingdom', scoreBand: 'medium', reasons: ['members'] }
];

export const MOCK_USER_MAP_RESPONSE: Record<MockVariant, MockUserMapResponse> = {
  normal: {
    variant: 'normal',
    data: {
      seedSummary: sharedSeedSummary,
      constellations: [metalConstellation, jazzConstellation]
    }
  },
  loading: {
    variant: 'loading',
    isLoading: true
  },
  empty: {
    variant: 'empty',
    data: {
      seedSummary: sharedSeedSummary,
      constellations: []
    }
  },
  partial: {
    variant: 'partial',
    data: {
      seedSummary: { ...sharedSeedSummary, unresolvedCount: 6 },
      constellations: [
        {
          ...metalConstellation,
          explorationTags: metalConstellation.explorationTags.slice(0, 2),
          recommendations: [...metalConstellation.recommendations.slice(0, 3), ...recommendationsBench.slice(0, 4)]
        }
      ]
    }
  },
  error: {
    variant: 'error',
    error: 'Mock network glitch - replace with real endpoint once available.'
  }
};

export const getMockUserMap = (variant: MockVariant = 'normal'): MockUserMapResponse => {
  return MOCK_USER_MAP_RESPONSE[variant] ?? MOCK_USER_MAP_RESPONSE.normal;
};

// TODO: Replace getMockUserMap with real API call once endpoints are live.
