import HomeEntry from './home-entry';
import LandingRest from './landing-rest';

export default function Home() {
  return <HomeEntry rest={<LandingRest />} />;
}
