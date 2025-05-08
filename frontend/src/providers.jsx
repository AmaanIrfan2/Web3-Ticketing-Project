import { WagmiProvider, createConfig, http } from 'wagmi';
import { optimism, arbitrum } from 'wagmi/chains';
import { getDefaultWallets, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

const chains = [optimism, arbitrum];

const { connectors } = getDefaultWallets({
  appName: 'Web3 Ticketing',
  projectId: 'ba216c110501f2343e21de669f4eb803',
  chains,
});

const wagmiConfig = createConfig({
  connectors,
  chains,
  transports: {
    [optimism.id]: http(),
    [arbitrum.id]: http(),
  },
  autoConnect: true,
});

export function Providers({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <RainbowKitProvider chains={chains} coolMode>
          {children}
        </RainbowKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}