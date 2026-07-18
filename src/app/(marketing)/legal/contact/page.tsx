import type { Metadata } from "next";

export const metadata: Metadata = { title: "Legal Contact" };

export default function LegalContactPage() {
  return (
    <>
      <h1>Legal Contact</h1>
      <p>
        For legal, privacy, and compliance enquiries about Tirvea, contact the operator of the
        platform:
      </p>
      <ul>
        <li>WiseWave Limited (Company Number 762171)</li>
        <li>Registered office: 39 Cooley Park, Dundalk, Co. Louth, A91 AP2V, Ireland</li>
        <li>
          Email: <a href="mailto:info@tirvea.com">info@tirvea.com</a>
        </li>
      </ul>
      <p>
        For specific matters, see the relevant policy - Law Enforcement Requests, Copyright, or
        Vulnerability Disclosure - which each set out a dedicated route.
      </p>
    </>
  );
}
