import getConfig from 'next/config'

import { withApiBasePath, withBasePath } from '@/utils/basePath'

jest.mock('next/config', () => jest.fn())

const mockedGetConfig = getConfig as jest.MockedFunction<typeof getConfig>

describe('base path helpers', () => {
  beforeEach(() => {
    mockedGetConfig.mockReset()
  })

  it('uses an absolute PUBLIC_PATH for reverse-proxied application requests', () => {
    mockedGetConfig.mockReturnValue({
      publicRuntimeConfig: {
        root: 'https://160.251.180.133/amano',
        basePath: '',
      },
    })

    expect(withBasePath('/api/admin/activity-logs/')).toBe(
      'https://160.251.180.133/amano/api/admin/activity-logs/'
    )
    expect(withApiBasePath('/api/admin/activity-logs/')).toBe(
      '/api/admin/activity-logs/'
    )
  })

  it('uses a relative PUBLIC_PATH when the proxy is mounted below the origin', () => {
    mockedGetConfig.mockReturnValue({
      publicRuntimeConfig: { root: '/amano', basePath: '' },
    })

    expect(withBasePath('/api/admin/activity-logs/')).toBe(
      '/amano/api/admin/activity-logs/'
    )
  })
})
