import base64
import io
import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from PIL import Image

from app.image_utils import image_from_data_url
from app.main import health, verify_token


def image_data_url(mime_type: str = "image/png") -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), (20, 80, 140)).save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


class BackendSecurityTests(unittest.TestCase):
    def test_backend_fails_closed_without_a_strong_token(self):
        with patch.dict(os.environ, {"VISION_BACKEND_TOKEN": ""}, clear=False):
            health_response = health()
            self.assertEqual(health_response.status_code, 503)
            with self.assertRaises(HTTPException) as context:
                verify_token(None)
        self.assertEqual(context.exception.status_code, 503)

    def test_backend_rejects_wrong_token_and_accepts_matching_token(self):
        token = "test-token-that-is-at-least-24-characters"
        with patch.dict(os.environ, {"VISION_BACKEND_TOKEN": token}, clear=False):
            self.assertTrue(health()["ok"])
            with self.assertRaises(HTTPException) as context:
                verify_token("Bearer wrong-token")
            self.assertEqual(context.exception.status_code, 401)
            verify_token(f"Bearer {token}")

    def test_image_decoder_accepts_valid_supported_image(self):
        image = image_from_data_url(image_data_url())
        self.assertEqual(image.size, (8, 8))
        self.assertEqual(image.mode, "RGB")

    def test_image_decoder_rejects_mime_content_mismatch(self):
        with self.assertRaisesRegex(ValueError, "does not match"):
            image_from_data_url(image_data_url("image/jpeg"))

    def test_image_decoder_rejects_invalid_base64(self):
        with self.assertRaisesRegex(ValueError, "valid JPEG"):
            image_from_data_url("data:image/png;base64,%%%")


if __name__ == "__main__":
    unittest.main()
