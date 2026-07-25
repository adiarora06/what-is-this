import unittest

from app.knowledge import build_card


class KnowledgeCardTests(unittest.TestCase):
    def test_animal_classes_do_not_generate_shopping_links(self):
        card = build_card("samoyed", 0.84, ["white coat"], [], class_index=258)

        self.assertEqual(card["category"], "animal")
        self.assertFalse(card["shoppingRecommended"])
        self.assertEqual(card["purchaseLinks"], [])
        self.assertIn("visual breed or species estimate", card["about"])

    def test_known_consumer_products_keep_shopping_links(self):
        card = build_card("smartphone", 0.9, ["screen"], [], class_index=487)

        self.assertEqual(card["category"], "electronics")
        self.assertTrue(card["shoppingRecommended"])
        self.assertGreater(len(card["purchaseLinks"]), 0)


if __name__ == "__main__":
    unittest.main()
