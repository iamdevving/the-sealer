import type { NextConfig } from "next";
import { withAxiom } from "next-axiom";

const nextConfig: NextConfig = {
  reactCompiler: true,
};

export default withAxiom(nextConfig);