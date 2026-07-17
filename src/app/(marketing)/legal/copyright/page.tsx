import type { Metadata } from "next";

export const metadata: Metadata = { title: "Copyright Policy" };

export default function CopyrightPage() {
  return (
    <>
      <h1>Copyright Policy</h1>
      <p>Last updated: 17 July 2026</p>

      <h2>1. Respect for intellectual property</h2>
      <p>
        WiseWave Limited respects the intellectual-property rights of others and expects Tirvea
        users to do the same. You must only upload content you own or have permission to use.
      </p>

      <h2>2. Reporting infringement</h2>
      <p>
        If you believe content on Tirvea infringes your copyright, send a notice to info@tirvea.com
        including:
      </p>
      <ul>
        <li>Your contact details.</li>
        <li>
          Identification of the copyrighted work and the allegedly infringing content
          (URL/location).
        </li>
        <li>A statement that you have a good-faith belief the use is not authorised.</li>
        <li>
          A statement, under penalty of perjury where applicable, that your notice is accurate and
          you are the rights holder or authorised to act.
        </li>
        <li>Your physical or electronic signature.</li>
      </ul>

      <h2>3. Our response</h2>
      <p>
        We review valid notices and may remove or disable access to the content. We may notify the
        person who posted it, who can submit a counter-notice.
      </p>

      <h2>4. Repeat infringers</h2>
      <p>We may suspend or terminate accounts of users who repeatedly infringe others’ rights.</p>

      <h2>5. Counter-notice</h2>
      <p>
        If your content was removed and you believe this was a mistake or misidentification, you may
        send a counter-notice to info@tirvea.com with the required details.
      </p>
    </>
  );
}
