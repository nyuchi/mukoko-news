import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ServiceWorkerRegister, getServiceWorkerUrl } from '@/components/pwa/sw-register';

type Listener = () => void;

function createEventTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener: vi.fn((type: string, cb: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(cb);
    }),
    removeEventListener: vi.fn((type: string, cb: Listener) => {
      listeners.get(type)?.delete(cb);
    }),
    emit(type: string) {
      listeners.get(type)?.forEach((cb) => cb());
    },
  };
}

function createMockWorker(state = 'installing') {
  return { state, postMessage: vi.fn(), ...createEventTarget() };
}

type MockWorker = ReturnType<typeof createMockWorker>;

function createMockRegistration(
  overrides: { waiting?: MockWorker | null; installing?: MockWorker | null } = {}
) {
  return { waiting: null, installing: null, ...createEventTarget(), ...overrides };
}

type MockRegistration = ReturnType<typeof createMockRegistration>;

function installMockContainer(
  registration: MockRegistration,
  { controller = {} as object | null } = {}
) {
  const container = {
    register: vi.fn().mockResolvedValue(registration),
    controller,
    ...createEventTarget(),
  };
  Object.defineProperty(window.navigator, 'serviceWorker', {
    value: container,
    configurable: true,
  });
  return container;
}

function removeMockContainer() {
  delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;
}

describe('getServiceWorkerUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses NEXT_PUBLIC_BUILD_ID when set', () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', 'build42');
    expect(getServiceWorkerUrl()).toBe('/sw.js?v=build42');
  });

  it('falls back to the Vercel commit SHA, then the constant', () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', '');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA', 'abc123def');
    expect(getServiceWorkerUrl()).toBe('/sw.js?v=abc123def');

    vi.stubEnv('NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA', '');
    expect(getServiceWorkerUrl()).toBe('/sw.js?v=v1');
  });
});

describe('ServiceWorkerRegister', () => {
  beforeEach(() => {
    // The component defers registration to the window load event unless the
    // document has already finished loading.
    Object.defineProperty(document, 'readyState', {
      value: 'complete',
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    removeMockContainer();
  });

  it('does not register outside production', async () => {
    const container = installMockContainer(createMockRegistration());
    render(<ServiceWorkerRegister />);
    await act(async () => {});
    expect(container.register).not.toHaveBeenCalled();
  });

  it('registers the versioned worker URL in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', 'build42');
    const container = installMockContainer(createMockRegistration());
    render(<ServiceWorkerRegister />);
    await waitFor(() => expect(container.register).toHaveBeenCalledWith('/sw.js?v=build42'));
  });

  it('renders nothing and does not crash when serviceWorker is unsupported', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { container } = render(<ServiceWorkerRegister />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the update banner for an already-waiting worker and posts SKIP_WAITING', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const waiting = createMockWorker('installed');
    installMockContainer(createMockRegistration({ waiting }));
    render(<ServiceWorkerRegister />);

    const refresh = await screen.findByRole('button', { name: /refresh/i });
    expect(screen.getByText('Update available')).toBeInTheDocument();

    fireEvent.click(refresh);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('shows the banner after updatefound → installed while controlled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const registration = createMockRegistration();
    const container = installMockContainer(registration);
    render(<ServiceWorkerRegister />);
    await waitFor(() => expect(container.register).toHaveBeenCalled());

    const installing = createMockWorker('installing');
    registration.installing = installing;
    act(() => registration.emit('updatefound'));

    installing.state = 'installed';
    act(() => installing.emit('statechange'));

    expect(await screen.findByText('Update available')).toBeInTheDocument();
  });

  it('does not prompt on the very first install (no controller yet)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const registration = createMockRegistration();
    const container = installMockContainer(registration, { controller: null });
    render(<ServiceWorkerRegister />);
    await waitFor(() => expect(container.register).toHaveBeenCalled());

    const installing = createMockWorker('installing');
    registration.installing = installing;
    act(() => registration.emit('updatefound'));
    installing.state = 'installed';
    act(() => installing.emit('statechange'));

    expect(screen.queryByText('Update available')).not.toBeInTheDocument();
  });

  it('reloads exactly once on controllerchange', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const container = installMockContainer(createMockRegistration());
    const reloadPage = vi.fn();
    render(<ServiceWorkerRegister reloadPage={reloadPage} />);
    await waitFor(() => expect(container.register).toHaveBeenCalled());

    act(() => container.emit('controllerchange'));
    act(() => container.emit('controllerchange'));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('can be dismissed', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const waiting = createMockWorker('installed');
    installMockContainer(createMockRegistration({ waiting }));
    render(<ServiceWorkerRegister />);

    await screen.findByText('Update available');
    fireEvent.click(screen.getByRole('button', { name: /dismiss update/i }));
    expect(screen.queryByText('Update available')).not.toBeInTheDocument();
  });
});
